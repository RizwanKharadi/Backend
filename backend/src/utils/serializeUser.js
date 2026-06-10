/**
 * Consistent user payload for API responses (mobile + web).
 */
export function serializeUser(user) {
  if (!user) {
    return null;
  }

  const companies = Array.isArray(user.companies)
    ? user.companies.map((c) => {
        if (c && typeof c === 'object') {
          return {
            id: c._id?.toString() || c.id,
            name: c.name,
            isActive: c.isActive
          };
        }
        return c;
      })
    : [];

  return {
    id: user._id?.toString() || user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    isEmailVerified: Boolean(user.isEmailVerified),
    isActive: user.isActive !== false,
    lastLogin: user.lastLogin || null,
    createdAt: user.createdAt || null,
    updatedAt: user.updatedAt || null,
    companies,
    preferences: user.preferences || undefined,
    organizationId: user.organizationId?.toString?.() || user.organizationId || undefined
  };
}
