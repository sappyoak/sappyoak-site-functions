import { AzureFunction, Context, HttpRequest } from '@azure/functions'
import { createHmac, timingSafeEqual } from 'node:crypto'

import { createQueueClient } from '../lib/storage'

const ALLOWED_EVENT_TO_ACTIONS_MAP = {
    deployment: ['created'],
    issues: ['*'],
    package: ['published', 'updated'],
    pull_request: ['closed', 'opened'],
    push: ['*'],
    release: ['published', 'released']
}

type GithubActivityItem = {
    actionCreated: string
    id: string,
    link: string,
    meta?: {[key: string]: string | number | boolean | undefined }
    repoId: string,
    repoName: string,
}

const feedTrigger: AzureFunction = async function (context: Context, request: HttpRequest): Promise<void> {
    const eventName = request.headers['X-GitHub-Event']
    const validationError = validateRequest(eventName, request, context.executionContext.invocationId)
    if (validationError) {
        context.log.error(validationError)
        return
    }

    const queueClient = createQueueClient(process.env.RAW_ACTIVITY_QUEUE_NAME as string)

    context.log.info(`Github webhook received a request from ${request.url}`);

    const allowedActionsForEvent = ALLOWED_EVENT_TO_ACTIONS_MAP[eventName]
    if (allowedActionsForEvent[0] !== '*' && !allowedActionsForEvent.includes(request.body.action)) {
        context.log.info(`Ignoring event: ${eventName} because webhook received an action: ${request.body.action} that is not targeted`)
        return
    }

    if (request.body.sender.login !== process.env.GITHUB_USERNAME) {
        context.log.verbose(`Received activity item from user: ${request.body.sender.login} who is not ${process.env.GITHUB_USERNAME}`)
        return
    }


    // @TODO need to actually do error-handling here.  Can utilize queue-storage as a DL queue for dropped activity feed items
    try {
        const entity = {
            partitionKey: 'github-activity',
            type: `${eventName}.${eventName === 'push' || eventName === 'issues' ? eventName : request.body.action}`,
            data: createGithubActivityItem(eventName, request.body)
        }

        await queueClient.sendMessage(JSON.stringify(entity))
    } catch (error) {
        context.log.error(error.message)
    }
}

export default feedTrigger

function createGithubActivityItem(eventName: string, payload) {
    const result: Partial<GithubActivityItem> = {
        repoId: payload.repository.id,
        repoName: payload.repository.name
    }

    // This event is a lot different to others and doesn't follow the same structure really.
    // target it specifically
    if (eventName === 'push') {
        return {
            ...result,
            actionCreated: payload.pushed_at,
            id: payload.head_commit.id,
            link: payload.head_commit.url,
            meta: { ref: payload.ref }
        }
    }


    result.actionCreated = payload[eventName].created_at
    result.id = payload[eventName].id

    if (eventName === 'package') {
        return {
            ...result,
            link: payload.package_version.release.url,
            meta: {
                name: payload.package.name,
                package_type: payload.package.package_type,
                version: payload.package.package_version.version
            }
        }
    }


    result.link = payload[eventName].url
    result.meta = getSelectedEventMetadata(eventName, payload)
    return result
}

function getSelectedEventMetadata(eventName: string, payload) {
    switch (eventName) {
        case 'deployment': return {
            environment: payload.deployment.environment,
            original_environment: payload.deployment.original_environment,
            ref: payload.deployment.ref         
        }
        case 'issues': return { state: payload.issue.state }
        case 'pull_request': return {
            owner: payload.pull_request.author_association === 'OWNER',
            title: payload.pull_request.title
        }
        case 'release': return { prerelease: payload.release.prerelease }
        default: return {}
    }
}

function validateRequest(eventName: string, request: HttpRequest, invocationId: string) {
    if (process.env.GITHUB_WEBHOOK_SECRET == undefined) {
        return `Cannot run the github webhook without setting process.env.GITHUB_WEBHOOK_SECRET`
    }

    if (process.env.RAW_ACTIVITY_TABLE_NAME == undefined) {
        return 'You need to specficy a raw activity table name'
    }

    if (!eventName) {
        return `Webhook run did not include an event name`
    }

    if (!ALLOWED_EVENT_TO_ACTIONS_MAP.hasOwnProperty(eventName)) {
        return `Received a webhook event ${eventName} that is currently not setup to be responded to`
    }

    const hashSignatureHeader = request.headers['X-Hub-Signature-256'];
    if (!hashSignatureHeader) {
        return `Received a github webhook without the proper hash header. ${JSON.stringify({
            headers: request.headers,
            invocationId,
            url: request.url
        })}`
    }

    const signature = Buffer.from(hashSignatureHeader, 'utf8')
    const hmac = createHmac('sha256', Buffer.from(process.env.GITHUB_WEBHOOK_SECRET))
    const digest = Buffer.from(`sha256=${hmac.update(JSON.stringify(request.body)).digest('hex')}`, 'utf8')

    if (signature.length !== digest.length || !timingSafeEqual(digest, signature)) {
        return `Request body digest did not match the signature header ${JSON.stringify({
            invocationId,
            signature
        })}`
    }
}
