import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

describe("Guest app SEV-2 audit fixes", () => {
  test("homepage availability defaults are timezone-aware and not hardcoded past dates", () => {
    const src = read("guest-app/src/pages/HomePage.tsx");
    expect(src).toMatch(/getDateKeyInTimezone\(config\.timezone,\s*1\)/);
    expect(src).toMatch(/getDateKeyInTimezone\(config\.timezone,\s*2\)/);
    expect(src).not.toMatch(/2026-06-12|2026-06-14/);
  });

  test("shared date picker uses the hotel timezone for today's minimum date", () => {
    const src = read("guest-app/src/components/DateRangePicker.tsx");
    expect(src).toMatch(/getDateKeyInTimezone\(config\.timezone\)/);
    expect(src).not.toMatch(/new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/);
  });

  test("Google sign-in no longer auto-registers members without consent", () => {
    const authSrc = read("guest-app/src/context/GuestAuthContext.tsx");
    const signInWithGoogle = authSrc.match(/const signInWithGoogle = async \(\) => \{[\s\S]*?\n\s*\};/);
    expect(signInWithGoogle?.[0]).toMatch(/signInWithPopup\(auth,\s*provider\)/);
    expect(signInWithGoogle?.[0]).not.toMatch(/registerMember/);

    const signupSrc = read("guest-app/src/pages/SignUpPage.tsx");
    const googleHandler = signupSrc.match(/const handleGoogleSignIn = async \(\) => \{[\s\S]*?\n\s*\};/);
    expect(googleHandler?.[0]).toMatch(/if \(!consent\)/);
    expect(googleHandler?.[0]).toMatch(/registerCurrentMember\(\)/);
  });

  test("member registration failures surface through auth/profile UI instead of console-only paths", () => {
    const authSrc = read("guest-app/src/context/GuestAuthContext.tsx");
    expect(authSrc).toMatch(/throw new Error\(result\?\.error \|\|/);

    const profileSrc = read("guest-app/src/pages/ProfilePage.tsx");
    expect(profileSrc).toMatch(/profileError/);
    expect(profileSrc).toMatch(/registerCurrentMember/);
    expect(profileSrc).toMatch(/Join \$\{config\.rewardsName\} first/);
  });

  test("guest room hydration never maps staff-only room private fields", () => {
    const src = read("guest-app/src/hooks/useRooms.ts");
    expect(src).toMatch(/blockReason:\s*""/);
    expect(src).toMatch(/remarks:\s*""/);
    expect(src).not.toMatch(/data\.remarks/);
    expect(src).not.toMatch(/data\.blockReason/);
  });

  test("admin room private notes use staff-only roomPrivate docs", () => {
    const adminSrc = read("admin-app/src/context/AdminContext.tsx");
    const rulesSrc = read("firebase/firestore.rules");

    expect(rulesSrc).toMatch(/match \/roomPrivate\/\{roomId\}/);
    expect(rulesSrc).toMatch(/allow read, create, update: if isStaff\(\)/);
    expect(adminSrc).toMatch(/collection\(db,\s*"roomPrivate"\)/);
    expect(adminSrc).toMatch(/delete dataToUpdate\.remarks/);
    expect(adminSrc).toMatch(/delete dataToUpdate\.blockReason/);
    expect(adminSrc).toMatch(/remarks:\s*deleteField\(\)/);
    expect(adminSrc).toMatch(/blockReason:\s*deleteField\(\)/);

    const createRoomBody = adminSrc.match(/const createRoom = async[\s\S]*?return \{ success: true, roomId: docRef\.id \};/);
    const publicRoomWrite = createRoomBody?.[0].match(/addDoc\(collection\(db,\s*"rooms"\),\s*\{[\s\S]*?\n\s*\}\);/);
    expect(publicRoomWrite?.[0]).not.toMatch(/remarks\s*:/);
    expect(publicRoomWrite?.[0]).not.toMatch(/blockReason\s*:/);
  });
});
