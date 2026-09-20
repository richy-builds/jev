import { TypeSafeClient } from "@typesafe-ai/sdk";

// Reads TYPESAFE_API_KEY from the server environment. Never shipped to the client.
// One client shared by every route so connections are reused between keystrokes.
export const client = new TypeSafeClient();
