import { VERSION } from "@spark-inn/shared";
import config from "@config";

export function App() {
  return (
    <main className="min-h-screen bg-gray-50 font-body text-gray-900">
      <section className="flex min-h-screen">
        <aside className="hidden w-72 flex-col bg-sidebar p-6 text-white md:flex">
          <div className="text-sm font-semibold uppercase tracking-wider text-primary">{config.brandName}</div>
          <div className="mt-8 space-y-2 text-sm text-gray-300">
            <div className="rounded-lg bg-primary px-3 py-2 font-medium text-white">Dashboard</div>
            <div className="px-3 py-2">Bookings</div>
            <div className="px-3 py-2">Rooms</div>
            <div className="px-3 py-2">Reports</div>
          </div>
          <div className="mt-auto text-xs text-gray-400">{config.brandName} v{VERSION}</div>
        </aside>
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="w-full max-w-2xl rounded-card bg-white p-8 shadow-sm ring-1 ring-gray-200">
            <p className="text-sm font-semibold uppercase text-primary">Phase 0</p>
            <h1 className="mt-3 font-heading text-4xl text-gray-950">Admin app scaffold</h1>
            <p className="mt-4 text-gray-600">
              The dashboard foundation is ready for auth, protected routes, and staff workflows.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
