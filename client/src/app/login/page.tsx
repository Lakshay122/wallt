"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Invalid credentials.");
      }

      router.push("/dashboard");
    } catch (err: any) {
      setError(err.message || "Failed to log in. Please check your credentials.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <Card className="w-full max-w-md shadow-md border-border bg-card">
        <CardHeader className="space-y-2 text-center">
          <CardTitle className="text-4xl font-extrabold tracking-tight text-foreground">
            Welcome Back
          </CardTitle>
          <CardDescription className="text-base text-muted-foreground">
            Sign in to access your tenant tickets and agent room.
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-5 text-base">
            {error && (
              <div className="rounded-lg bg-destructive/10 p-4 text-base text-destructive border border-destructive/20 font-medium">
                {error}
              </div>
            )}
            
            <div className="space-y-2">
              <Label htmlFor="email" className="text-base font-semibold">Email Address</Label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="alice@acme.com"
                value={formData.email}
                onChange={handleChange}
                required
                className="h-11 text-base"
              />
            </div>

            <div className="space-y-2 pb-3">
              <Label htmlFor="password" className="text-base font-semibold">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                placeholder="••••••••"
                value={formData.password}
                onChange={handleChange}
                required
                className="h-11 text-base"
              />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col space-y-6">
            <Button type="submit" className="w-full h-12 bg-primary text-primary-foreground hover:bg-primary/90 text-lg font-bold transition-all" disabled={loading}>
              {loading ? "Authenticating..." : "Sign In"}
            </Button>
            <div className="text-center text-base text-muted-foreground">
              New to Helpdesk?{" "}
              <Link href="/signup" className="font-bold text-foreground hover:underline underline-offset-4">
                Create a workspace
              </Link>
            </div>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
