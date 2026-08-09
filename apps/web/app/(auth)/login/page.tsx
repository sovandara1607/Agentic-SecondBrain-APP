import { LoginForm } from "@/components/login-form";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const initialError =
    params.error === "auth_callback_failed"
      ? "GitHub sign in failed. Please try again."
      : null;

  return (
    <main className="flex min-h-screen items-center justify-center">
      <LoginForm initialError={initialError} />
    </main>
  );
}
