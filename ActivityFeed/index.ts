import { AzureFunction, Context, HttpRequest } from '@azure/functions'
import { createTableClient } from '../lib/storage'


const activityFeed: AzureFunction = async function (context: Context, request: HttpRequest): Promise<void> {
    try {
        const client = createTableClient(process.env.ACTIVITY_FEED_TABLE_NAME as string)
        const pageSize = request.params.limit && !Number.isNaN(request.params.limit) ? Number(request.params.limit) : null
        
        if (request.params.continuationToken) {
            const page = await client.listEntities().byPage({ maxPageSize: pageSize ?? 20, continuationToken: request.params.continuationToken }).next()
            const results = []

            if (!page.done) {
                for (const entity of page.value) {
                    results.push(entity)
                }
            }

            context.bindings.response = {
                status: 200,
                data: results
            }
            return
        }

        const results = []
        
        let iterator = pageSize != null 
            ? client.listEntities().byPage({ maxPageSize: pageSize })
            : client.listEntities()
        
        for await (const entity of iterator) {
            results.push(entity)
        }

        context.bindings.response = {
            status: 200,
            data: results
        }
        return
    } catch (error) {
        context.log.error(`Could not fetch the activity feed`, error)
        context.bindings.response = {
            status: 400,
            error
        }
    }
}

export default activityFeed