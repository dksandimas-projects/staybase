import { VERSION } from "@spark-inn/shared";
import config from "@config";

export function App() {
  return (
    <main className="min-h-screen bg-white font-body text-gray-900">
      <section className="flex min-h-screen items-center justify-center bg-section-bg px-6 py-16">
        <div className="w-full max-w-3xl rounded-card bg-white p-8 shadow-sm ring-1 ring-gray-200">
          <p className="text-sm font-semibold uppercase text-primary">Phase 0</p>
          <h1 className="mt-3 font-heading text-5xl text-gray-950">{config.brandName}</h1>
          <p className="mt-4 text-lg text-gray-600">{config.brandPromise}</p>
          <div className="mt-8 grid gap-3 text-sm text-gray-600 sm:grid-cols-3">
            <span className="rounded-lg bg-primary-light px-4 py-3">Guest app scaffold</span>
            <span className="rounded-lg bg-primary-light px-4 py-3">Vite + React 19</span>
            <span className="rounded-lg bg-primary-light px-4 py-3">Shared v{VERSION}</span>
          </div>
        </div>
      </section>
    </main>
  );
}
