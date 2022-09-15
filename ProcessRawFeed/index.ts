import { AzureFunction, Context } from '@azure/functions'
import { formatISO } from 'date-fns'
import { createTableClient, createQueueClient } from '../lib/storage'


const processFeedQueueTrigger: AzureFunction = async function (context: Context, message: Record<string, any>) {
    const tableClient = createTableClient(process.env.ACTIVITY_FEED_TABLE_NAME as string)

    // As long as type is unique among events this should be fine for row keys and having a non psuedo-random key
    // allows us to optimize checking for existing feed items by asking for the entity directly rather than querying the whole parition
    const rowKey = `${message.queueTrigger.type}.${formatISO(new Date()).split('T')[0]}`

    let existingEntity

    try {
        existingEntity = tableClient.getEntity(message.queueTrigger.partitionKey, rowKey)
    } catch (error) {
        if (error.code !== 'EntityNotFound') {
            context.log.error(`${context.executionContext.invocationId} could not fetch entity ${rowKey} from partition ${message.queueTrigger.partitionKey}.`, error)
            return
        }
    }

    const publishMode = existingEntity ? 'UPDATE' : 'INSERT'
    const entity = existingEntity
        ? { ...existingEntity, actions: [...existingEntity.actions, message.queueTrigger.data ]}
        : createNewEntry(rowKey, message.queueTrigger)

    try {
        await tableClient.upsertEntity(entity, "Merge")
        context.log.info(`Successfully performed operation ${publishMode} on entity ${entity.rowKey} in table ${process.env.ACTIVITY_FEED_TABLE_NAME}`)
    } catch (error) {
        // @TODO retries depending on the error
        context.log.error(`Could not write entity to activity feed`, error)
        return
    }

    context.bindings.socketMessages = [{
        target: "activityFeed",
        arguments: [{ entity, publishMode }]
    }]

    try {
        context.log.info(`Successfully handled message ${message.id} triggered for ${message.queueTrigger.type}. Removing message from queue`)

        const queueClient = createQueueClient(process.env.RAW_ACTIVITY_QUEUE_NAME as string)
        await queueClient.deleteMessage(message.id, message.popReceipt)
    } catch (error) {
        // @TODO retry this delete
        context.log.error(`Could not delete message ${message.id} from queue ${process.env.RAW_ACTIVITY_QUEUE_NAME}`);
    }
}

function createNewEntry(rowKey, queueTrigger) {
    return {
        partitionKey: queueTrigger.partitionKey,
        rowKey,
        actions: [queueTrigger.data]
    }
}


export default processFeedQueueTrigger