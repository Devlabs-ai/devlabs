import type { JwtPayload } from './domain';

export {};

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export type ExpressHandler = import('express').RequestHandler;
export type ExpressRouter = import('express').Router;
export type ExpressRequest = import('express').Request;
export type ExpressResponse = import('express').Response;
export type ExpressNextFunction = import('express').NextFunction;

export interface ApiErrorBody {
  error: string;
  hint?: string;
  [key: string]: unknown;
}
