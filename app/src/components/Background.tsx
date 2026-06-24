/** Ambient animated backdrop — neon grid + drifting orbs. */
export function Background() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      {/* grid */}
      <div
        className="absolute inset-0 opacity-[0.15]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(34,227,255,0.25) 1px, transparent 1px), linear-gradient(90deg, rgba(34,227,255,0.25) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage: 'radial-gradient(ellipse 70% 60% at 50% 0%, black, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse 70% 60% at 50% 0%, black, transparent 75%)',
        }}
      />
      {/* orbs */}
      <div className="absolute -top-40 left-1/4 h-[36rem] w-[36rem] rounded-full bg-neon/10 blur-[120px] animate-pulseGlow" />
      <div className="absolute top-1/3 -right-40 h-[32rem] w-[32rem] rounded-full bg-harm/10 blur-[120px] animate-pulseGlow" />
      <div className="absolute bottom-0 left-0 h-[28rem] w-[28rem] rounded-full bg-gboy/[0.07] blur-[120px]" />
    </div>
  );
}
