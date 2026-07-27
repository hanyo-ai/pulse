import React, { useState, useEffect } from "react";
import { useTranslation } from "../i18n";
import type { User } from "../types";

// Normalize SQLite UTC timestamps: old format lacks timezone, new format has Z suffix.
function toUTC(ts: string): Date {
  return new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
}

interface UserManagementProps {
  token: string;
  currentUser: User;
}

export default function UserManagement({ token, currentUser }: UserManagementProps) {
  const { t } = useTranslation();
  const [users, setUsers] = useState<User[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [error, setError] = useState("");
  const [formData, setFormData] = useState({
    username: "",
    password: "",
    display_name: "",
    role: "user" as "admin" | "user",
  });

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    const res = await fetch("/api/auth/users", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) setUsers(data);
    }
  };

  const handleCreate = () => {
    setEditingUser(null);
    setError("");
    setFormData({ username: "", password: "", display_name: "", role: "user" });
    setShowModal(true);
  };

  const handleEdit = (user: User) => {
    setEditingUser(user);
    setError("");
    setFormData({
      username: user.username,
      password: "",
      display_name: user.display_name || "",
      role: user.role,
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (editingUser) {
      const updateData: Record<string, unknown> = {};
      if (formData.display_name !== editingUser.display_name) {
        updateData.display_name = formData.display_name;
      }
      if (formData.role !== editingUser.role) {
        updateData.role = formData.role;
      }
      if (formData.password) {
        updateData.password = formData.password;
      }

      const res = await fetch(`/api/auth/users/${editingUser.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(updateData),
      });

      if (res.ok) {
        await loadUsers();
        setShowModal(false);
      } else {
        const data = await res.json();
        setError(data.error || t("users.updateFailed"));
      }
    } else {
      const res = await fetch("/api/auth/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(formData),
      });

      if (res.ok) {
        await loadUsers();
        setShowModal(false);
      } else {
        const data = await res.json();
        setError(data.error || t("users.createFailed"));
      }
    }
  };

  const handleDelete = async (user: User) => {
    if (!confirm(t("users.deleteConfirm", { username: user.username }))) return;
    const res = await fetch(`/api/auth/users/${user.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      await loadUsers();
    } else {
      const data = await res.json();
      alert(data.error || t("users.deleteFailed"));
    }
  };

  const roleBadgeStyle = (role: string): React.CSSProperties => ({
    display: "inline-block",
    padding: "2px 10px",
    borderRadius: "var(--radius-sm)",
    fontSize: "12px",
    fontWeight: 600,
    background: role === "admin" ? "var(--amber)" : "var(--accent-subtle)",
    color: role === "admin" ? "#fff" : "var(--accent)",
  });

  return (
    <section className="section active page">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "16px",
          flexWrap: "wrap",
          gap: "10px",
        }}
      >
        <p style={{ color: "var(--muted)", fontSize: "13px" }}>{t("users.title")}</p>
        <button className="btn btn-primary btn-sm" onClick={handleCreate}>{t("users.add")}</button>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("users.colUsername")}</th>
              <th>{t("users.colDisplayName")}</th>
              <th>{t("users.colRole")}</th>
              <th>{t("users.colCreated")}</th>
              <th style={{ width: "160px" }}>{t("users.colActions")}</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty-state">{t("users.noUsers")}</td>
              </tr>
            ) : users.map((user) => (
              <tr key={user.id}>
                <td className="mono">{user.username}</td>
                <td>{user.display_name || "—"}</td>
                <td>
                  <span style={roleBadgeStyle(user.role)}>
                    {user.role === "admin" ? t("role.admin") : t("role.user")}
                  </span>
                </td>
                <td className="mono">{user.created_at ? toUTC(user.created_at).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" }) : "—"}</td>
                <td>
                  <button className="btn btn-sm" style={{ marginRight: "6px" }} onClick={() => handleEdit(user)}>
                    {t("users.edit")}
                  </button>
                  {user.id !== currentUser.id && (
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={() => handleDelete(user)}
                    >
                      {t("users.delete")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div
            className="card modal"
            style={{ width: 420 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>{editingUser ? t("users.editUser") : t("users.newUser")}</h3>
              <button className="modal-close" onClick={() => setShowModal(false)}>×</button>
            </div>

            {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}

            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom: "14px" }}>
                <label className="field-label">{t("users.colUsername")}</label>
                <input
                  type="text"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  disabled={!!editingUser}
                  required
                  className="input"
                />
              </div>
              <div style={{ marginBottom: "14px" }}>
                <label className="field-label">
                  {t("users.password")} {editingUser ? t("users.passwordHint") : ""}
                </label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  required={!editingUser}
                  className="input"
                />
              </div>
              <div style={{ marginBottom: "14px" }}>
                <label className="field-label">{t("users.colDisplayName")}</label>
                <input
                  type="text"
                  value={formData.display_name}
                  onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
                  className="input"
                />
              </div>
              <div style={{ marginBottom: "14px" }}>
                <label className="field-label">{t("users.colRole")}</label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value as "admin" | "user" })}
                  className="input"
                >
                  <option value="user">{t("role.user")}</option>
                  <option value="admin">{t("role.admin")}</option>
                </select>
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 6 }}>
                <button type="button" className="btn" onClick={() => setShowModal(false)}>
                  {t("users.cancel")}
                </button>
                <button type="submit" className="btn btn-primary">
                  {editingUser ? t("users.update") : t("users.create")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
