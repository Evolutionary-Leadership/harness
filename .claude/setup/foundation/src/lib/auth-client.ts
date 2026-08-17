"use client";

import { createAuthClient } from "better-auth/react";

/**
 * The browser side auth client.
 *
 * No baseURL: Better Auth defaults to the current origin, which is what makes
 * this work unchanged on localhost, on dev, on production, and on every ephemeral
 * feature environment without a build time variable.
 */
export const authClient = createAuthClient();
