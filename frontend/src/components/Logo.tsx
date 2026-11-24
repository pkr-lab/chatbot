export const Logo = ({ height = 30 }: { height?: number }) => (
  <img className="logo" src="/logo.png" alt="Plaudi" height={height} style={{ height }} decoding="async" fetchPriority="high" />
);
