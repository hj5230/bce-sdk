import crypto from 'node:crypto';

export interface BceCredential {
    ak: string;
    sk: string;
}

export interface RequestInfo {
    params?: Array<[string, string]> | undefined;
    headers: Record<string, string>;
    method: string;
    url: string;
}

const NORMALIZE_MAP: Record<string, string> = {
    '!': '%21',
    '\'': '%27',
    '(': '%28',
    ')': '%29',
    '*': '%2A',
};

const normalize = (value: string) =>
    encodeURIComponent(value).replace(/[!'()*]/g, v => NORMALIZE_MAP[v]);

const canonicalizeSearchParams = (params: Array<[string, string]> | undefined) => {
    if (!params) {
        return '';
    }

    const canonicalize = ([key, value]: [string, string]) => {
        if (key.toLowerCase() === 'authorization') {
            return [];
        }
        return `${key}=${normalize(value)}`;
    };
    return params.flatMap(canonicalize).sort().join('&');
};

const DEFAULT_HEADERS_TO_SIGN = ['host', 'content-md5', 'content-length', 'content-type'];

interface CanonicalizeHeadersContext {
    signedHeaderNames: string[];
    canonicalizedHeaders: string[];
}

interface CanonicalizeHeadersResult {
    signedHeaderNames: string[];
    canonicalizedHeaders: string;
}

const canonicalizeHeaders = (headers: Record<string, string>, headerNamesToSign = DEFAULT_HEADERS_TO_SIGN) => {
    const {signedHeaderNames, canonicalizedHeaders} = Object.entries(headers).reduce(
        (result, [name, value]) => {
            const headerName = name.toLowerCase();
            const headerValue = typeof value === 'string' ? value.trim() : value;

            if (headerValue && (headerNamesToSign.includes(headerName) || headerName.startsWith('x-bce-'))) {
                result.signedHeaderNames.push(headerName);
                result.canonicalizedHeaders.push(`${normalize(headerName)}:${normalize(headerValue)}`);
            }

            return result;
        },
        {signedHeaderNames: [], canonicalizedHeaders: []} as CanonicalizeHeadersContext
    );
    const result: CanonicalizeHeadersResult = {
        signedHeaderNames,
        canonicalizedHeaders: canonicalizedHeaders.sort().join('\n'),
    };
    return result;
};

const hash = (key: string, data: string) => {
    const mac = crypto.createHmac('sha256', key);
    mac.update(data);
    return mac.digest('hex');
};

interface Options {
    timestamp: string;
    headerNamesToSign?: string[];
    expireInSeconds?: number;
}

interface SignatureContext {
    canonicalRequest: string;
    signedHeaderNames: string[];
    authStringPrefix: string;
    signingKey: string;
    signature: string;
}

export class Authorization {
    constructor(private readonly credentials: BceCredential) {}

    // NOTE: 百度云V1签名算法，你改一个字都会跑不过去你信不信
    authorize(request: RequestInfo, options: Options): string {
        const context = this.createContext(request, options);
        return `${context.authStringPrefix}/${context.signedHeaderNames.join(';')}/${context.signature}`;
    }

    private createContext(request: RequestInfo, options: Options): SignatureContext {
        const {signedHeaderNames, canonicalizedHeaders} = canonicalizeHeaders(
            request.headers,
            options.headerNamesToSign
        );
        const canonicalRequestParts = [
            request.method,
            request.url,
            canonicalizeSearchParams(request.params),
            canonicalizedHeaders,
        ];
        const canonicalRequest = canonicalRequestParts.join('\n');
        const authStringPrefix = `bce-auth-v1/${this.credentials.ak}/${options.timestamp}/${
            options.expireInSeconds || 1800
        }`;
        const signingKey = hash(this.credentials.sk, authStringPrefix);
        const signature = hash(signingKey, canonicalRequest);
        return {
            canonicalRequest,
            signedHeaderNames,
            authStringPrefix,
            signingKey,
            signature,
        };
    }
}
