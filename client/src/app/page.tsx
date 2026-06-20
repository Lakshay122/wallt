import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground">
      {/* Navigation Header */}
      <header className="px-8 h-20 flex items-center justify-between border-b border-border bg-background sticky top-0 z-50">
        <div className="flex items-center gap-2">
          <span className="text-2xl font-extrabold tracking-tight text-foreground">
            Helpdesk SaaS
          </span>
        </div>
        <nav className="flex items-center gap-6">
          <Link href="/login">
            <Button variant="ghost" className="text-base font-semibold px-4 py-2">
              Sign In
            </Button>
          </Link>
          <Link href="/signup">
            <Button className="bg-primary text-primary-foreground hover:bg-primary/90 text-base font-semibold px-5 py-2.5">
              Get Started
            </Button>
          </Link>
        </nav>
      </header>

      {/* Hero Section */}
      <main className="flex-1 flex flex-col items-center justify-center text-center px-6 py-32">
        <div className="space-y-8 max-w-4xl">
          <h1 className="text-5xl sm:text-7xl font-black tracking-tighter text-foreground leading-tight">
            Multi-Tenant Support Room
            <span className="block mt-3 text-muted-foreground">
              Empowered by AI
            </span>
          </h1>
          <p className="text-xl sm:text-2xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Manage customer conversations, automate tickets, and speed up resolution workflows with an integrated Dead Letter Queue and multi-LLM suggestion streaming.
          </p>
          <div className="flex flex-col sm:flex-row gap-6 justify-center pt-6">
            <Link href="/signup">
              <Button size="lg" className="w-full sm:w-auto bg-primary text-primary-foreground hover:bg-primary/90 px-10 py-6 text-lg font-bold shadow-md">
                Create Free Workspace
              </Button>
            </Link>
            <Link href="/login">
              <Button size="lg" variant="outline" className="w-full sm:w-auto border-border hover:bg-accent hover:text-accent-foreground px-10 py-6 text-lg font-bold">
                Log In
              </Button>
            </Link>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-8 border-t border-border text-center text-base text-muted-foreground">
        © {new Date().getFullYear()} Helpdesk SaaS. Built using Tailwind CSS, ShadCN UI, and Next.js.
      </footer>
    </div>
  );
}
