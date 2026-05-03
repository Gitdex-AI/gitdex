export function ShellLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="layout">
      <main className="content">{children}</main>
    </div>
  );
}
