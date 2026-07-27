import { Elysia } from "elysia";
import { getDb } from "../db";
import { requireAuth, requireAdmin } from "../middleware/auth";
import type { UserRole } from "../types";

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

function createAuthSession(userId: number): string {
  const db = getDb();
  const token = generateToken();
  const sessionId = crypto.randomUUID();
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  db.run(
    "INSERT INTO auth_sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)",
    [sessionId, userId, token, expiresAt]
  );
  return token;
}

export const authRoutes = new Elysia({ prefix: "/api/auth" })
  .post("/login", async ({ body }) => {
    const db = getDb();
    const { username, password } = body as { username: string; password: string };

    const user = db
      .query("SELECT * FROM users WHERE username = ?")
      .get(username) as Record<string, unknown> | null;
    if (!user) {
      return new Response(JSON.stringify({ error: "用户名或密码错误" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const valid = await Bun.password.verify(password, user.password_hash as string);
    if (!valid) {
      return new Response(JSON.stringify({ error: "用户名或密码错误" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const token = createAuthSession(user.id as number);
    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        role: user.role,
      },
    };
  })
  .post("/logout", ({ headers }) => {
    const auth = headers["authorization"];
    if (auth) {
      const [, token] = auth.split(" ");
      if (token) {
        const db = getDb();
        db.run("DELETE FROM auth_sessions WHERE token = ?", [token]);
      }
    }
    return { success: true };
  })
  // Self-service: change password
  .post("/change-password", async ({ body, headers }) => {
    const result = requireAuth(headers["authorization"] ?? null);
    if (result instanceof Response) return result;

    const db = getDb();
    const { oldPassword, newPassword } = body as { oldPassword: string; newPassword: string };

    if (!oldPassword || !newPassword) {
      return new Response(JSON.stringify({ error: "Both old and new password are required" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }
    if (newPassword.length < 8) {
      return new Response(JSON.stringify({ error: "New password must be at least 8 characters" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    const user = db.query("SELECT password_hash FROM users WHERE id = ?").get(result.user.id) as { password_hash: string } | null;
    if (!user) {
      return new Response(JSON.stringify({ error: "User not found" }), {
        status: 404, headers: { "Content-Type": "application/json" },
      });
    }

    const valid = await Bun.password.verify(oldPassword, user.password_hash);
    if (!valid) {
      return new Response(JSON.stringify({ error: "Current password is incorrect" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    const passwordHash = await Bun.password.hash(newPassword, "bcrypt");
    db.run("UPDATE users SET password_hash = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?", [passwordHash, result.user.id]);

    // Invalidate all other sessions (keep current one by token)
    db.run("DELETE FROM auth_sessions WHERE user_id = ? AND token != ?", [result.user.id, result.token]);

    return { success: true };
  })
  .get("/me", ({ headers }) => {
    const result = requireAuth(headers["authorization"] ?? null);
    if (result instanceof Response) return result;
    return result.user;
  })
  // Admin-only: list users
  .get("/users", ({ headers }) => {
    const result = requireAdmin(headers["authorization"] ?? null);
    if (result instanceof Response) return result;
    const db = getDb();
    return db
      .query("SELECT id, username, display_name, role, created_at FROM users ORDER BY id ASC")
      .all();
  })
  // Admin-only: create user
  .post("/users", async ({ body, headers }) => {
    const result = requireAdmin(headers["authorization"] ?? null);
    if (result instanceof Response) return result;

    const db = getDb();
    const { username, password, display_name, role = "user" } = body as {
      username: string;
      password: string;
      display_name?: string;
      role?: string;
    };

    if (!username || username.length < 3 || username.length > 50 || !/^[\w-]+$/.test(username)) {
      return new Response(
        JSON.stringify({ error: "用户名需为3-50位字母、数字、下划线或连字符" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    if (!password || password.length < 8) {
      return new Response(JSON.stringify({ error: "密码至少8位" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (role !== "admin" && role !== "user") {
      return new Response(JSON.stringify({ error: "角色无效" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const existing = db.query("SELECT id FROM users WHERE username = ?").get(username);
    if (existing) {
      return new Response(JSON.stringify({ error: "用户名已存在" }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      });
    }

    const passwordHash = await Bun.password.hash(password, "bcrypt");
    db.run(
      "INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)",
      [username, passwordHash, display_name || username, role]
    );

    const newUser = db
      .query("SELECT id, username, display_name, role, created_at FROM users WHERE username = ?")
      .get(username);
    return newUser;
  })
  // Admin-only: update user
  .put("/users/:id", async ({ params, body, headers }) => {
    const result = requireAdmin(headers["authorization"] ?? null);
    if (result instanceof Response) return result;

    const db = getDb();
    const userId = parseInt(params.id);
    const { display_name, role, password } = body as {
      display_name?: string;
      role?: string;
      password?: string;
    };

    const user = db.query("SELECT id, username FROM users WHERE id = ?").get(userId) as {
      id: number;
      username: string;
    } | null;
    if (!user) {
      return new Response(JSON.stringify({ error: "用户不存在" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Prevent demoting yourself
    if (role && role !== "admin" && userId === result.user.id) {
      return new Response(JSON.stringify({ error: "不能修改自己的权限" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (role && role !== "admin" && role !== "user") {
      return new Response(JSON.stringify({ error: "角色无效" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (display_name !== undefined) {
      db.run("UPDATE users SET display_name = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?", [
        display_name,
        userId,
      ]);
    }
    if (role !== undefined) {
      db.run("UPDATE users SET role = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?", [
        role as UserRole,
        userId,
      ]);
    }
    if (password) {
      if (password.length < 8) {
        return new Response(JSON.stringify({ error: "密码至少8位" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      const passwordHash = await Bun.password.hash(password, "bcrypt");
      db.run("UPDATE users SET password_hash = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?", [
        passwordHash,
        userId,
      ]);
      // Invalidate all sessions for this user
      db.run("DELETE FROM auth_sessions WHERE user_id = ?", [userId]);
    }

    return db
      .query("SELECT id, username, display_name, role, created_at FROM users WHERE id = ?")
      .get(userId);
  })
  // Admin-only: delete user
  .delete("/users/:id", ({ params, headers }) => {
    const result = requireAdmin(headers["authorization"] ?? null);
    if (result instanceof Response) return result;

    const userId = parseInt(params.id);
    if (userId === result.user.id) {
      return new Response(JSON.stringify({ error: "不能删除自己的账号" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const db = getDb();
    const user = db.query("SELECT id FROM users WHERE id = ?").get(userId);
    if (!user) {
      return new Response(JSON.stringify({ error: "用户不存在" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    db.run("DELETE FROM users WHERE id = ?", [userId]);
    return { success: true };
  });
