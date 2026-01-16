// types/nostr.ts - TypeScript interfaces for Nostr protocol

export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export interface NostrProfile {
  name?: string;
  about?: string;
  picture?: string;
  nip05?: string;
  lud16?: string;
  [key: string]: any;
}

export interface RelayMessage {
  type: 'EVENT' | 'EOSE' | 'OK' | 'NOTICE' | 'CLOSED';
  data?: any;
}

export interface RelayRequest {
  type: 'REQ' | 'CLOSE';
  id: string;
  filters?: NostrFilter[];
}

export interface NostrFilter {
  ids?: string[];
  authors?: string[];
  kinds?: number[];
  '#e'?: string[];
  '#p'?: string[];
  since?: number;
  until?: number;
  limit?: number;
  [key: string]: any;
}

export interface WebSocketMessage {
  data: string;
}

export interface RelayConnection {
  url: string;
  socket: WebSocket;
  connected: boolean;
}

// Utility types
export type PubkeyHex = string;
export type Npub = string;
export type EventId = string;

// API response types
export interface OGPData {
  [key: string]: string;
}

export interface APIError {
  error: string;
}

export interface APISuccess<T = any> {
  data: T;
  success: boolean;
}