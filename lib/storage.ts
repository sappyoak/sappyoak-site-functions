import { TableClient, AzureNamedKeyCredential } from '@azure/data-tables'
import { QueueServiceClient, StorageSharedKeyCredential } from '@azure/storage-queue'

export function createTableClient(tableName: string) {
    if (!tableName || tableName === '') {
        throw new Error(`tableName cannot be an empty string`)
    }

    if (!process.env.STORAGE_ACCOUNT_NAME) {
        throw new Error(`A Table account name must be provided`)
    }
    
    if (!process.env.STORAGE_ACCOUNT_KEY) {
        throw new Error(`A table account key must be provided`)
    }

    const credentials = new AzureNamedKeyCredential(process.env.STORAGE_ACCOUNT_NAME, process.env.STORAGE_ACCOUNT_KEY)
    return new TableClient(`https://${process.env.STORAGE_ACCOUNT_NAME}.table.core.windows.net`, tableName, credentials)
}

export function createQueueClient(queueName: string) {
    if (!process.env.STORAGE_ACCOUNT_NAME) {
        throw new Error(`storage account name must be provided`)
    }

    if (!process.env.STORAGE_ACCOUNT_KEY) {
        throw new Error("A storage account key must be provided")
    }

    const credentials = new StorageSharedKeyCredential(process.env.STORAGE_ACCOUNT_NAME, process.env.STORAGE_ACCOUNT_KEY)
    const queueServiceClient = new QueueServiceClient(`https://${process.env.STORAGE_ACCOUNT_NAME}.queue.core.windows.net`, credentials)
    
    return queueServiceClient.getQueueClient(queueName)
}