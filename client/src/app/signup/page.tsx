"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

export default function SignupPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  
  const [formData, setFormData] = useState({
    tenantName: "",
    tenantDescription: "",
    tenantType: "SaaS",
    name: "",
    email: "",
    password: "",
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSelectChange = (value: string) => {
    setFormData({ ...formData, tenantType: value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Something went wrong during signup.");
      }

      router.push("/dashboard");
    } catch (err: any) {
      setError(err.message || "Failed to connect to the server.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-16 text-foreground">
      <Card className="w-full max-w-xl shadow-md border-border bg-card">
        <CardHeader className="space-y-2 text-center">
          <CardTitle className="text-4xl font-extrabold tracking-tight text-foreground">
            Create Workspace
          </CardTitle>
          <CardDescription className="text-base text-muted-foreground">
            Register a new tenant organization and provision the admin account.
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-6 text-base">
            {error && (
              <div className="rounded-lg bg-destructive/10 p-4 text-base text-destructive border border-destructive/20 font-medium">
                {error}
              </div>
            )}
            
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="tenantName" className="text-base font-semibold">Workspace Name</Label>
                <Input
                  id="tenantName"
                  name="tenantName"
                  placeholder="Acme Corp"
                  value={formData.tenantName}
                  onChange={handleChange}
                  required
                  className="h-11 text-base"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="tenantType" className="text-base font-semibold">Workspace Industry</Label>
                <Select value={formData.tenantType} onValueChange={handleSelectChange}>
                  <SelectTrigger id="tenantType" className="w-full !h-11 text-base">
                    <SelectValue placeholder="Select industry" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SaaS">SaaS / Cloud</SelectItem>
                    <SelectItem value="Finance">Finance</SelectItem>
                    <SelectItem value="Healthcare">Healthcare</SelectItem>
                    <SelectItem value="Education">Education</SelectItem>
                    <SelectItem value="E-commerce">E-commerce</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="tenantDescription" className="text-base font-semibold">Workspace Description</Label>
              <Input
                id="tenantDescription"
                name="tenantDescription"
                placeholder="Enterprise cloud and engineering support platform..."
                value={formData.tenantDescription}
                onChange={handleChange}
                className="h-11 text-base"
              />
            </div>

            <div className="border-t border-border my-6" />

            <div className="space-y-2">
              <Label htmlFor="name" className="text-base font-semibold">Admin Full Name</Label>
              <Input
                id="name"
                name="name"
                placeholder="Alice Admin"
                value={formData.name}
                onChange={handleChange}
                required
                className="h-11 text-base"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email" className="text-base font-semibold">Admin Email Address</Label>
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
              {loading ? "Creating workspace..." : "Get Started"}
            </Button>
            <div className="text-center text-base text-muted-foreground">
              Already have a workspace?{" "}
              <Link href="/login" className="font-bold text-foreground hover:underline underline-offset-4">
                Log in
              </Link>
            </div>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
