import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { db } from "~/server/db";
import { users, userTemperatureProfile } from "~/server/db/schema";
import { cookies } from "next/headers";
import {
  authenticate,
  obtainFreshAccessToken,
  AuthError,
} from "~/server/eight/auth";
import { eq } from "drizzle-orm";
import { type Token } from "~/server/eight/types";
import { TRPCError } from "@trpc/server";
import { adjustTemperature } from "~/app/api/temperatureCron/route";
import jwt from "jsonwebtoken";
import { getIntervalsData } from "~/server/eight/user";
import { CLIENT_API_URL } from "~/server/eight/constants";

class DatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseError";
  }
}

const checkAuthCookie = async (headers: Headers) => {
  const cookies = headers.get("cookie");
  console.log("Checking cookies");
  if (!cookies) {
    throw new AuthError(`Auth request failed. No cookies found.`, 401);
  }

  const token = cookies
    .split("; ")
    .find((row) => row.startsWith("8slpAutht="))
    ?.split("=")[1];
  console.log("Token:", token);

  if (!token) {
    throw new AuthError(`Auth request failed. No cookies found.`, 401);
  }
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
      email: string;
    };
  } catch {
    throw new AuthError(`Auth request failed. Invalid token.`, 401);
  }

  return decoded;
};

export const userRouter = createTRPCRouter({
  checkLoginState: publicProcedure.query(async ({ ctx }) => {
    try {
      let decoded;
      try {
        decoded = await checkAuthCookie(ctx.headers);
      } catch (error) {
        if (error instanceof AuthError) {
          return { loginRequired: true };
        }
        throw error;
      }
      const email = decoded.email;

      const userList = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .execute();

      if (userList.length !== 1 || userList[0] === undefined) {
        return { loginRequired: true };
      }

      const user = userList[0];

      // check if token is expired, and if so, refresh it
      if (user.eightTokenExpiresAt < new Date()) {
        console.log("Token expired, refreshing for user", user.email);
        try {
          const {
            eightAccessToken,
            eightRefreshToken,
            eightExpiresAtPosix: expiresAt,
          } = await obtainFreshAccessToken(
            user.eightRefreshToken,
            user.eightUserId,
          );

          await db
            .update(users)
            .set({
              eightAccessToken,
              eightRefreshToken,
              eightTokenExpiresAt: new Date(expiresAt),
            })
            .where(eq(users.email, email))
            .execute();

          return { loginRequired: false };
        } catch (error) {
          console.error("Token renewal failed:", error);
          return { loginRequired: true };
        }
      }
      return { loginRequired: false };
    } catch (error) {
      console.error("Error in checkLoginState:", error);
      throw new Error(
        "An unexpected error occurred while checking login state.",
      );
    }
  }),

  login: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        const authResult = await authenticateUser(input.email, input.password);

        const approvedEmails = process.env.APPROVED_EMAILS!.split(",").map(email => email.toLowerCase());

        if (!approvedEmails.includes(input.email.toLowerCase())) {
          throw new AuthError("Email not approved");
        }

        await saveUserToDatabase(input.email, authResult);

        const jwtSecret = process.env.JWT_SECRET;
        if (!jwtSecret) {
          throw new Error("JWT_SECRET is not defined in the environment");
        }

        const token = jwt.sign({ email: input.email }, jwtSecret, {
          expiresIn: "90d",
        });
        const threeMonthsInSeconds = 90 * 24 * 60 * 60; // 90 days

        cookies().set("8slpAutht", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "strict",
          maxAge: threeMonthsInSeconds,
          path: "/",
        });
        console.log("Saving token to cookie.");

        // Set HTTP-only cookie
        return {
          success: true,
        };
      } catch (error) {
        console.error("Error in login process:", error);
        if (error instanceof AuthError) {
          throw new Error(`Authentication failed: ${error.message}`);
        } else if (error instanceof DatabaseError) {
          throw new Error(
            "Failed to save login information. Please try again.",
          );
        } else {
          throw new Error(
            "An unexpected error occurred. Please try again later.",
          );
        }
      }
    }),
  logout: publicProcedure.mutation(async () => {
    try {
      cookies().set("8slpAutht", "", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 0,
        path: "/",
      });
      return {
        success: true,
      };
    } catch (error) {
      console.error("Error during logout:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred during logout.",
      });
    }
  }),

  getUserTemperatureProfile: publicProcedure.query(async ({ ctx }) => {
    try {
      const decoded = await checkAuthCookie(ctx.headers);

      const profile = await db.query.userTemperatureProfile.findFirst({
        where: eq(userTemperatureProfile.email, decoded.email),
      });

      if (!profile) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Temperature profile not found for this user.",
        });
      }

      return profile;
    } catch (error) {
      console.error("Error fetching user temperature profile:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          "An unexpected error occurred while fetching the temperature profile.",
      });
    }
  }),

  updateUserTemperatureProfile: publicProcedure
    .input(
      z.object({
        bedTime: z.string().time(),
        wakeupTime: z.string().time(),
        initialSleepLevel: z.number().int().min(-100).max(100),
        midStageSleepLevel: z.number().int().min(-100).max(100),
        finalSleepLevel: z.number().int().min(-100).max(100),
        timezoneTZ: z.string().max(50),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const decoded = await checkAuthCookie(ctx.headers);
        const updatedProfile = {
          email: decoded.email,
          bedTime: input.bedTime,
          wakeupTime: input.wakeupTime,
          initialSleepLevel: input.initialSleepLevel,
          midStageSleepLevel: input.midStageSleepLevel,
          finalSleepLevel: input.finalSleepLevel,
          timezoneTZ: input.timezoneTZ,
          updatedAt: new Date(),
        };
        console.log("Updated profile:", updatedProfile);

        await db
          .insert(userTemperatureProfile)
          .values(updatedProfile)
          .onConflictDoUpdate({
            target: userTemperatureProfile.email,
            set: {
              bedTime: input.bedTime,
              wakeupTime: input.wakeupTime,
              initialSleepLevel: input.initialSleepLevel,
              midStageSleepLevel: input.midStageSleepLevel,
              finalSleepLevel: input.finalSleepLevel,
              timezoneTZ: input.timezoneTZ,
              updatedAt: new Date(),
            },
          })
          .execute();

        await adjustTemperature();

        return { success: true };
      } catch (error) {
        console.error("Error updating user temperature profile:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            "An unexpected error occurred while updating the temperature profile.",
        });
      }
    }),

  deleteUserTemperatureProfile: publicProcedure.mutation(async ({ ctx }) => {
    try {
      const decoded = await checkAuthCookie(ctx.headers);
      const email = decoded.email;

      // Delete user temperature profile
      const result = await db
        .delete(userTemperatureProfile)
        .where(eq(userTemperatureProfile.email, email))
        .execute();

      if (result.rowCount === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Temperature profile not found for this user.",
        });
      }

      return {
        success: true,
        message: "User temperature profile deleted successfully",
      };
    } catch (error) {
      console.error("Error deleting user temperature profile:", error);
      if (error instanceof TRPCError) {
        throw error;
      }
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          "An unexpected error occurred while deleting the user temperature profile.",
      });
    }
  }),

  getTemperatureIntervals: publicProcedure.query(async ({ ctx }) => {
    try {
      const decoded = await checkAuthCookie(ctx.headers);
      const email = decoded.email;

      // Get user from database
      const userList = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .execute();

      if (userList.length !== 1 || userList[0] === undefined) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found.",
        });
      }

      const user = userList[0];

      // Create token object
      let token: Token = {
        eightAccessToken: user.eightAccessToken,
        eightRefreshToken: user.eightRefreshToken,
        eightExpiresAtPosix: user.eightTokenExpiresAt.getTime(),
        eightUserId: user.eightUserId,
      };

      // Refresh token if expired
      if (new Date().getTime() > token.eightExpiresAtPosix) {
        token = await obtainFreshAccessToken(
          token.eightRefreshToken,
          token.eightUserId,
        );
        await db
          .update(users)
          .set({
            eightAccessToken: token.eightAccessToken,
            eightRefreshToken: token.eightRefreshToken,
            eightTokenExpiresAt: new Date(token.eightExpiresAtPosix),
          })
          .where(eq(users.email, email));
      }

      // Fetch interval data with error handling
      try {
        const intervals = await getIntervalsData(token, user.eightUserId);
        
        return {
          success: true,
          intervals: intervals || [],
        };
      } catch (apiError) {
        console.error("Primary API call failed, trying fallback:", apiError);
        
        // Fallback: Try making a direct API call without strict schema validation
        try {
          const url = `${CLIENT_API_URL}/users/${user.eightUserId}/intervals`;
          const response = await fetch(url, {
            headers: {
              "content-type": "application/json",
              "connection": "keep-alive",
              "user-agent": "Android App",
              "accept-encoding": "gzip",
              "accept": "application/json",
              "host": "client-api.8slp.net",
              "authorization": `Bearer ${token.eightAccessToken}`,
            },
          });
          
          if (!response.ok) {
            throw new Error(`API request failed: ${response.status}`);
          }
          
          const rawData = await response.json() as { result?: { intervals?: unknown[] } };
          
          // Return whatever we got, or empty array
          return {
            success: true,
            intervals: rawData?.result?.intervals || [],
            message: rawData?.result?.intervals?.length === 0 
              ? "No interval data available yet. Sleep data will appear after using your mattress."
              : undefined
          };
        } catch (fallbackError) {
          console.error("Fallback API call also failed:", fallbackError);
          // Return empty array with helpful message
          return {
            success: true,
            intervals: [],
            message: "No interval data available yet. Sleep data will appear after using your mattress."
          };
        }
      }
    } catch (error) {
      console.error("Error fetching temperature intervals:", error);
      if (error instanceof TRPCError) {
        throw error;
      }
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          "An unexpected error occurred while fetching temperature intervals.",
      });
    }
  }),
});

async function authenticateUser(email: string, password: string) {
  try {
    return await authenticate(email, password);
  } catch (error) {
    if (error instanceof AuthError) {
      throw error; // Propagate the AuthError with its specific message
    } else {
      throw new AuthError("Failed to authenticate user");
    }
  }
}

async function saveUserToDatabase(email: string, authResult: Token) {
  try {
    await db
      .insert(users)
      .values({
        email,
        eightAccessToken: authResult.eightAccessToken,
        eightRefreshToken: authResult.eightRefreshToken,
        eightTokenExpiresAt: new Date(authResult.eightExpiresAtPosix),
        eightUserId: authResult.eightUserId,
      })
      .onConflictDoUpdate({
        target: users.email,
        set: {
          eightAccessToken: authResult.eightAccessToken,
          eightRefreshToken: authResult.eightRefreshToken,
          eightTokenExpiresAt: new Date(authResult.eightExpiresAtPosix),
          eightUserId: authResult.eightUserId,
        },
      })
      .execute();
  } catch (error) {
    console.error("Database operation failed:", error);
    throw new DatabaseError("Failed to save user token to database.");
  }
}
