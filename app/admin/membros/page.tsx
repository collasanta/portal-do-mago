import MembersAdmin from "@/components/admin/MembersAdmin";

// Client-side screen: every call goes through /api/portal/members*, gated to admin/host keys.
export default function MembrosPage() {
  return <MembersAdmin />;
}
