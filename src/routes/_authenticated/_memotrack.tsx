import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/_memotrack")({
  component: () => (
    <div className="memotrack">
      <Outlet />
    </div>
  ),
});
