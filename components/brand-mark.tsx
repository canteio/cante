type BrandMarkProps = {
  className?: string;
};

export function BrandMark({ className = "" }: BrandMarkProps) {
  return (
    <img
      alt=""
      aria-hidden="true"
      className={`cante-mark ${className}`.trim()}
      height={64}
      src="/cante-beagle.png"
      width={64}
    />
  );
}
