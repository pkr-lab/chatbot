export const Logo = ({ height = 30 }: { height?: number }) => (
  <img className="logo" src="/logo.svg" alt="Plaudi" width={Math.round((height * 170) / 48)} height={height} decoding="async" />
);
