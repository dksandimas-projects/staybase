import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for SEV-1 #5: AdminContext.members was a hardcoded
// useState<Member[]>([fake entry]) — staff could not manage real members.
// Per W1.12 / decision #85, the fix is a real `onSnapshot` listener on
// the `members` collection with proper unmount cleanup.

describe("AdminContext.tsx — members useState<Member[]> mock removed (SEV-1 #5)", () => {
  const src = readFileSync(
    resolve(__dirname, "../../../admin-app/src/context/AdminContext.tsx"),
    "utf8"
  );

  it("no longer hardcodes a fake member in useState initial value", () => {
    // The old code was: const [members, setMembers] = useState<Member[]>([{
    //   id: "mem-42", memberNumber: "SR-00042", fullName: "Alex Mercer", ...
    // }]);
    expect(src).not.toMatch(/useState<Member\[\]>\(\[\s*\{\s*id:\s*["']mem-42["']/);
    expect(src).not.toMatch(/memberNumber:\s*["']SR-00042["']/);
    expect(src).not.toMatch(/fullName:\s*["']Alex Mercer["']/);
    expect(src).not.toMatch(/email:\s*["']member@sparkinn\.com["']/);
  });

  it("initializes members as an empty array (replaced by onSnapshot)", () => {
    // Pattern: const [members, setMembers] = useState<Member[]>([]);
    expect(src).toMatch(/const\s+\[members\s*,\s*setMembers\]\s*=\s*useState<Member\[\]>\(\[\]\)/);
  });

  it("subscribes to onSnapshot on the members collection", () => {
    // The fix uses: collection(db, "members") + onSnapshot
    expect(src).toMatch(/collection\(db\s*,\s*["']members["']\)/);
    expect(src).toMatch(/onSnapshot\(\s*membersRef\s*,/);
  });

  it("returns the unsubscribe from useEffect for proper cleanup", () => {
    // The pattern is: useEffect(() => { if (!currentUser) return; ...; return unsubscribe; }, [currentUser])
    expect(src).toMatch(/useEffect\(\(\)\s*=>\s*\{\s*if\s*\(!currentUser\)\s*return;[^}]*onSnapshot\(\s*membersRef/);
    expect(src).toMatch(/return\s+unsubscribe;\s*\}\s*,\s*\[currentUser\]\)/);
  });

  it("guards the members listener behind currentUser (permission-denied fix)", () => {
    // Regression test: the members listener used to fire unconditionally
    // on mount, including on the /login route (AdminProvider wraps the
    // whole route tree). Firestore rules require auth for `members` reads,
    // so an unauthenticated listen crashed with an uncaught
    // permission-denied error on the login page. It must not attach until
    // currentUser resolves, and must have an error callback so a future
    // permission hiccup logs instead of surfacing as "Uncaught Error in
    // snapshot listener".
    const membersEffectMatch = src.match(
      /const membersRef = collection\(db, "members"\);[\s\S]*?\}, \[currentUser\]\);/
    );
    expect(membersEffectMatch).not.toBeNull();
    const membersEffect = membersEffectMatch![0];
    expect(membersEffect).toMatch(/\(error\)\s*=>\s*\{\s*console\.error\(/);
  });
});
