export enum ContentType {
  JSON = 'application/json',
  TEXT = 'text/plain',
  SSE = 'text/event-stream',
}

export enum HttpHeader {
  ContentType = 'content-type',
  Accept = 'accept',
  Authorization = 'authorization',
  CacheControl = 'cache-control',
  Connection = 'connection',
}

export enum DomoHeader {
  DeveloperToken = 'x-domo-developer-token',
  EmbeddedSecurity = 'x-domo-embedded-security',
  EpsAuthToken = 'x-eps-auth-token',
}
