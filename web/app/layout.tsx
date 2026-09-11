export const metadata = {
  title: 'QA Workbench',
  description: 'Agentic QA Automation Platform dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#0b0d12', color: '#e6e8eb' }}>
        {children}
      </body>
    </html>
  );
}
