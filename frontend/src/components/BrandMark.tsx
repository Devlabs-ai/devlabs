import React from 'react';

interface BrandMarkProps {
  className?: string;
  title?: string;
}

/** Node-graph mark — shared DevSetu brand icon (same as favicon). */
export default function BrandMark({
  className = 'brand-mark',
  title = 'DevSetu',
}: BrandMarkProps): JSX.Element {
  return (
    <img
      className={className}
      src="/devsetu-mark.svg"
      alt={title || ''}
      aria-hidden={title ? undefined : true}
      draggable={false}
    />
  );
}
