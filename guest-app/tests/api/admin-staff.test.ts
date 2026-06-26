import { beforeEach, describe, expect, test, vi } from "vitest";

const {
  mockCreateUser,
  mockSetCustomUserClaims,
  mockUpdateUser,
  mockDeleteUser,
  mockGuestDocs,
  mockGuestSet
} = vi.hoisted(() => ({
  mockCreateUser: vi.fn(),
  mockSetCustomUserClaims: vi.fn(),
  mockUpdateUser: vi.fn(),
  mockDeleteUser: vi.fn(),
  mockGuestDocs: new Map<string, any>(),
  mockGuestSet: vi.fn()
}));

vi.mock("../../server/lib/firebase-admin", () => ({
  adminAuth: {
    createUser: mockCreateUser,
    setCustomUserClaims: mockSetCustomUserClaims,
    updateUser: mockUpdateUser,
    deleteUser: mockDeleteUser
  },
  adminDb: {
    collection: vi.fn().mockImplementation((collectionName: string) => {
      if (collectionName !== "guests") return { doc: vi.fn() };

      return {
        doc: vi.fn().mockImplementation((uid: string) => ({
          path: `guests/${uid}`,
          get: vi.fn().mockResolvedValue(
            mockGuestDocs.has(uid)
              ? { exists: true, data: () => mockGuestDocs.get(uid) }
              : { exists: false }
          ),
          set: mockGuestSet
        })),
        where: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({
            docs: Array.from(mockGuestDocs.entries())
              .filter(([, data]) => data.role === "admin")
              .map(([id, data]) => ({ id, data: () => data }))
          })
        })
      };
    })
  }
}));

import { handleCreateStaff, handleDisableStaff } from "../../server/handlers/admin";

const mockResponse = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const adminStaff = {
  uid: "admin_1",
  role: "admin",
  email: "admin@sparkinn.com"
};

describe("/api/admin staff handlers", () => {
  beforeEach(() => {
    mockCreateUser.mockReset();
    mockSetCustomUserClaims.mockReset();
    mockUpdateUser.mockReset();
    mockGuestSet.mockReset();
    mockGuestDocs.clear();
    mockGuestDocs.set("admin_1", {
      fullName: "Admin One",
      email: "admin@sparkinn.com",
      role: "admin",
      isActive: true
    });
  });

  test("creates staff auth user, role claim, and guest profile", async () => {
    mockCreateUser.mockResolvedValueOnce({ uid: "staff_1" });
    const req = {
      method: "POST",
      staff: adminStaff,
      body: {
        fullName: "Front Desk One",
        email: "FRONTDESK@EXAMPLE.TEST",
        password: "securepass123",
        phone: "+63 917 000 0000",
        role: "front-desk"
      }
    };
    const res = mockResponse();

    await handleCreateStaff(req, res);

    expect(mockCreateUser).toHaveBeenCalledWith({
      email: "frontdesk@example.test",
      password: "securepass123",
      displayName: "Front Desk One",
      disabled: false
    });
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith("staff_1", { role: "front-desk" });
    expect(mockGuestSet).toHaveBeenCalledWith(expect.objectContaining({
      fullName: "Front Desk One",
      email: "frontdesk@example.test",
      role: "front-desk",
      isActive: true,
      createdBy: "admin_1"
    }));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        uid: "staff_1",
        email: "frontdesk@example.test",
        role: "front-desk"
      }
    });
  });

  test("returns a friendly conflict for duplicate staff email", async () => {
    mockCreateUser.mockRejectedValueOnce({ code: "auth/email-already-exists" });
    const req = {
      method: "POST",
      staff: adminStaff,
      body: {
        fullName: "Front Desk One",
        email: "frontdesk@example.test",
        password: "securepass123",
        role: "front-desk"
      }
    };
    const res = mockResponse();

    await handleCreateStaff(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: "A staff account with this email already exists."
    });
  });

  test("prevents an admin from disabling their own account", async () => {
    const req = {
      method: "POST",
      staff: adminStaff,
      body: { uid: "admin_1" }
    };
    const res = mockResponse();

    await handleDisableStaff(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  test("prevents disabling the last active admin", async () => {
    const req = {
      method: "POST",
      staff: { ...adminStaff, uid: "super_admin" },
      body: { uid: "admin_1" }
    };
    const res = mockResponse();

    await handleDisableStaff(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: "You must keep at least one active admin account."
    });
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  test("disables a staff auth user and marks profile inactive", async () => {
    mockGuestDocs.set("staff_1", {
      fullName: "Front Desk One",
      email: "frontdesk@example.test",
      role: "front-desk",
      isActive: true
    });
    const req = {
      method: "POST",
      staff: adminStaff,
      body: { uid: "staff_1" }
    };
    const res = mockResponse();

    await handleDisableStaff(req, res);

    expect(mockUpdateUser).toHaveBeenCalledWith("staff_1", { disabled: true });
    expect(mockGuestSet).toHaveBeenCalledWith(expect.objectContaining({
      isActive: false,
      disabledBy: "admin_1"
    }), { merge: true });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { uid: "staff_1" }
    });
  });

  // Per S4 (soft batch 2026-06-26): the staff-creation
  // path is non-atomic across auth + claims + Firestore.
  // If the post-create sync fails, the orphaned auth user
  // is rolled back so the operator can retry the create.
  describe("S4 transactional consistency", () => {
    beforeEach(() => {
      mockCreateUser.mockReset();
      mockSetCustomUserClaims.mockReset();
      mockUpdateUser.mockReset();
      mockDeleteUser.mockReset();
      mockGuestSet.mockReset();
      mockGuestDocs.clear();
    });

    test("rolls back the auth user if the claims write fails", async () => {
      mockCreateUser.mockResolvedValue({ uid: "new_staff" });
      mockSetCustomUserClaims.mockRejectedValue(new Error("claims service down"));
      mockDeleteUser.mockResolvedValue(undefined);

      const res = mockResponse();
      await handleCreateStaff(
        {
          method: "POST",
          staff: adminStaff,
          body: {
            fullName: "Test User",
            email: "test@example.test",
            password: "password123",
            role: "front-desk"
          }
        } as any,
        res
      );
      expect(res.status).toHaveBeenCalledWith(500);
      expect(mockDeleteUser).toHaveBeenCalledWith("new_staff");
    });

    test("rolls back the auth user if the Firestore set fails", async () => {
      mockCreateUser.mockResolvedValue({ uid: "new_staff" });
      mockSetCustomUserClaims.mockResolvedValue(undefined);
      mockGuestSet.mockRejectedValue(new Error("firestore unavailable"));
      mockDeleteUser.mockResolvedValue(undefined);

      const res = mockResponse();
      await handleCreateStaff(
        {
          method: "POST",
          staff: adminStaff,
          body: {
            fullName: "Test User",
            email: "test@example.test",
            password: "password123",
            role: "front-desk"
          }
        } as any,
        res
      );
      expect(res.status).toHaveBeenCalledWith(500);
      expect(mockDeleteUser).toHaveBeenCalledWith("new_staff");
    });

    test("writes Firestore before disabling the auth user", async () => {
      const callOrder: string[] = [];
      mockGuestSet.mockImplementation(async () => { callOrder.push("firestore"); });
      mockUpdateUser.mockImplementation(async () => { callOrder.push("auth"); });
      mockGuestDocs.set("staff_1", { role: "front-desk", isActive: true });

      const res = mockResponse();
      await handleDisableStaff(
        { method: "POST", staff: adminStaff, body: { uid: "staff_1" } } as any,
        res
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(callOrder).toEqual(["firestore", "auth"]);
    });

    test("rolls back the Firestore disable if the auth update fails", async () => {
      const writes: any[] = [];
      mockGuestSet.mockImplementation(async (patch: any) => { writes.push(patch); });
      mockUpdateUser.mockRejectedValue(new Error("auth service down"));
      mockGuestDocs.set("staff_1", { role: "front-desk", isActive: true });

      const res = mockResponse();
      await handleDisableStaff(
        { method: "POST", staff: adminStaff, body: { uid: "staff_1" } } as any,
        res
      );
      expect(res.status).toHaveBeenCalledWith(500);
      // First write: disable; second write: rollback.
      expect(writes[0]).toMatchObject({ isActive: false });
      expect(writes[1]).toMatchObject({ isActive: true, disabledAt: null });
    });
  });
});
