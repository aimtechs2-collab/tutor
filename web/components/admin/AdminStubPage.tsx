type AdminStubPageProps = {
  title: string;
  description: string;
};

export default function AdminStubPage({ title, description }: AdminStubPageProps) {
  return (
    <div className="min-h-screen bg-[var(--background)] px-4 py-10">
      <div className="mx-auto max-w-3xl rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-[var(--foreground)]">{title}</h1>
        <p className="mt-3 text-sm text-[var(--muted-foreground)]">{description}</p>
      </div>
    </div>
  );
}
