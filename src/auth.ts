import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { env } from "@/lib/env";

// Local development only: sign in as any email without Google.
const devLogin =
  process.env.NODE_ENV === "development" && process.env.DEV_LOGIN === "1"
    ? [
        Credentials({
          id: "dev",
          credentials: { email: {} },
          authorize: (c) => (typeof c.email === "string" && c.email ? { email: c.email.toLowerCase(), name: c.email } : null),
        }),
      ]
    : [];

export const devLoginEnabled = devLogin.length > 0;

// Any Google account may sign in; what it can see is decided by memberships
// (src/lib/authz.ts), so an account with none just sees an empty list.
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google, ...devLogin],
  // Nothing re-issues the cookie (no middleware, no client session fetch), so this is a fixed time from sign-in, not an idle timeout.
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/login" },
  callbacks: {
    async signIn({ profile, user, account }) {
      const viaDev = account?.provider === "dev" && devLoginEnabled;
      const email = (viaDev ? user.email : profile?.email)?.toLowerCase();
      if (!email || (!viaDev && profile?.email_verified !== true)) return false;
      await db
        .insert(users)
        .values({ email, name: profile?.name ?? user.name ?? null, isAdmin: env.adminEmails.has(email), lastSeenAt: new Date() })
        .onConflictDoUpdate({
          target: users.email,
          set: {
            name: profile?.name ?? null,
            lastSeenAt: new Date(),
            // Env-listed admins are promoted on every sign-in; others keep their flag.
            isAdmin: env.adminEmails.has(email) ? true : sql`${users.isAdmin}`,
          },
        });
      return true;
    },
    async jwt({ token, profile, user }) {
      const email = profile?.email ?? user?.email;
      if (email) token.email = email.toLowerCase();
      return token;
    },
  },
});
