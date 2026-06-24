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
    expect(src).toMatch(/onSnapshot\(membersRef\s*,/);
  });

  it("returns the unsubscribe from useEffect for proper cleanup", () => {
    // The pattern is: useEffect(() => { ...; return unsubscribe; }, [])
    expect(src).toMatch(/useEffect\(\(\)\s*=>\s*\{[^}]*onSnapshot\(membersRef/);
    expect(src).toMatch(/return\s+unsubscribe;\s*\}\s*,\s*\[\]\)/);
  });
});
