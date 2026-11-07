import type { SessionInfo as APISession } from "../../api/types.js";

import type { Hydrate } from "./index.js";

export type HydratedSession = {
  id: string;
  name: string;
};

export const sessionHydration: Hydrate<APISession, HydratedSession> = {
  keyMapping: {
    _id: "id",
  },
  functions: {
    id: (server) => server._id,
    name: (server) => server.name,
  },
  initialHydration: () => ({}),
};
