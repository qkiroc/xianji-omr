import "express";
declare global {
  namespace Express {
    interface Request {
      identity: { kind: "cookie" | "bearer"; scopes: string[]; id?: string };
      token: string;
    }
  }
}
