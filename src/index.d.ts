export type Protocol = 'TCP' | 'UDP' | 'tcp' | 'udp';
export type SortField = 'port' | 'protocol' | 'pid' | 'process' | 'state';

export interface PortEntry {
  protocol: string;
  port: number;
  address: string;
  state: string;
  pid: number;
  process: string;
  service?: string;
  user?: string;
  command?: string;
}
export interface PortOptions {
  all?: boolean;
  protocol?: Protocol;
  port?: number;
  pid?: number;
  process?: string;
  search?: string;
  state?: string;
  sort?: SortField;
  details?: boolean;
}
export interface BindOptions { protocol?: Protocol; host?: string }
export interface WatchOptions extends PortOptions { interval?: number; signal?: AbortSignal }
export interface PortChanges { added: PortEntry[]; removed: PortEntry[] }
export interface PortSnapshot extends PortChanges { current: PortEntry[]; timestamp: string }

export function getPorts(options?: PortOptions): Promise<PortEntry[]>;
export function checkPort(port: number, options?: BindOptions): Promise<boolean>;
export function findPort(options?: BindOptions & { from?: number; to?: number }): Promise<number | null>;
export function diffPorts(previous: PortEntry[], current: PortEntry[]): PortChanges;
export function watchPorts(options?: WatchOptions): AsyncGenerator<PortSnapshot, void, unknown>;
export function parseLsof(output: string, options?: { all?: boolean }): PortEntry[];
export function parseNetstat(output: string, options?: { all?: boolean }): PortEntry[];

export type ColorMode = 'auto' | 'always' | 'never';
export interface PortConfig {
  color?: ColorMode;
  sort?: SortField;
  interval?: number; // Seconds, as in the CLI configuration file.
  protocol?: Protocol;
  all?: boolean;
  details?: boolean;
}
export interface PortInspection {
  port: number;
  protocol: string;
  host: string;
  available: boolean;
  conflicts: PortEntry[];
}
export function inspectPort(port: number, options?: BindOptions): Promise<PortInspection>;
export function loadConfig(path?: string): Promise<PortConfig>;
export function formatPorts(entries: PortEntry[], options?: { color?: boolean; details?: boolean; changes?: PortChanges | null }): string;
export function runTui(options?: PortOptions & { interval?: number; color?: ColorMode; alerts?: boolean }): Promise<void>;

/** Returns a conventional service name or an empty string if unknown. */
export function getServiceName(port: number, protocol?: Protocol): string;
/** Rechecks the selected socket, then sends SIGTERM to its process. */
export function stopPortProcess(entry: PortEntry): Promise<void>;
/** Emits a terminal bell when changes are present; returns whether a bell was written. */
export function alertPortChanges(changes: PortChanges, options?: { stream?: { write(value: string): unknown } }): boolean;
