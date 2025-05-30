import { Handler, type Route, route } from "@std/http/unstable-route";
import type { GitHubUser } from "./db.ts";
import { getCurrentUser } from "./auth.ts";

export class Router {
  #routes: Route[] = [];

  currentUser?: GitHubUser | null;

  get(path: string, handler: Handler) {
    this.#addRoute("GET", path, handler);
  }

  post(path: string, handler: Handler) {
    this.#addRoute("POST", path, handler);
  }

  put(path: string, handler: Handler) {
    this.#addRoute("PUT", path, handler);
  }

  delete(path: string, handler: Handler) {
    this.#addRoute("DELETE", path, handler);
  }

  #addRoute(method: string, path: string, handler: Handler) {
    const pattern = new URLPattern({ pathname: path });

    this.#routes.push({
      pattern,
      method,
      handler: async (req, info, params) => {
        try {
          this.currentUser = await getCurrentUser(req);
          return await handler(req, info!, params!);
        } catch (error) {
          console.error("Error handling request:", error);
          return new Response("Internal Server Error", { status: 500 });
        }
      },
    });
  }

  get handler() {
    return route(
      this.#routes,
      () => new Response("Not Found", { status: 404 }),
    );
  }
}
