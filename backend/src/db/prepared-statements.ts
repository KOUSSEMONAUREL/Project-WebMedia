import { PostgresJsSession } from 'drizzle-orm/postgres-js';

const PREPARED_FLAG = Symbol.for('webmedia.preparedStatements');

export function enablePreparedStatements() {
    const prototype = PostgresJsSession.prototype as any;
    if (prototype[PREPARED_FLAG]) return;
    const original = prototype.prepareQuery;
    prototype.prepareQuery = function (
        query: any,
        fields: any,
        name: string | undefined,
        isResponseInArrayMode: boolean,
        customResultMapper?: any,
        queryMetadata?: any,
        cacheConfig?: any
    ) {
        const prepare = this.client?.options?.prepare === true;
        return original.call(
            this,
            query,
            fields,
            prepare ? (name ?? 'webmedia') : name,
            isResponseInArrayMode,
            customResultMapper,
            queryMetadata,
            cacheConfig
        );
    };
    prototype[PREPARED_FLAG] = true;
}
