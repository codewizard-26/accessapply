import { db } from "../src/db/index.js";
import { users, userProfiles } from "../src/db/schema.js";

import { eq } from "drizzle-orm";

async function main() {
  const allUsers = await db.select().from(users).where(eq(users.email, "yashwant@gmail.com"));
  console.log("=== USER yashwant@gmail.com ===");
  console.log(allUsers);

  if (allUsers[0]) {
    const profile = await db.select().from(userProfiles).where(eq(userProfiles.userId, allUsers[0].id));
    console.log("=== PROFILE FOR yashwant@gmail.com ===");
    console.log(profile);
  }

  const u2 = await db.select().from(users).where(eq(users.id, "7a038711-39bb-493a-9973-9e9520e208a0"));
  console.log("=== USER 7a038711-39bb-493a-9973-9e9520e208a0 ===");
  console.log(u2);
}

main().catch(console.error);
