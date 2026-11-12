// Описание tools/server.mjs для проверки типов в тестах.

export const PROTOCOL: number;
export const MAX_PLAYERS: number;

/** На сколько шагов вперёд отправлять ввод при таких замерах связи игроков (мс туда-обратно). */
export function delayFor(rtts: number[]): number;

export interface GameServer {
  /** Порт, на котором сервер слушает. */
  port: number;
  /** Адрес в домашней сети — его открывает второй игрок. */
  lan: string;
  /** Папка, из которой раздаётся игра. */
  root: string;
  close(): Promise<void>;
}

export interface ServerOptions {
  port?: number;
  host?: string;
  /** Папка со сборкой игры: путь или file-URL. По умолчанию dist/. */
  root?: string | URL;
  /** Не печатать журнал. */
  quiet?: boolean;
}

export function startServer(options?: ServerOptions): Promise<GameServer>;
