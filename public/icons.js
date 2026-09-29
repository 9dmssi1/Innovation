// Локальные SVG: значки поясняют подписи, а не заменяют их.
const shapes = {
  basics: '<path d="M6 6l12 2M6 6l4 12M18 8l-8 10"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="8" r="3"/><circle cx="10" cy="18" r="3"/>',
  bfs: '<path d="M12 6v5M5 11h14M5 11v6M12 11v6M19 11v6"/><circle cx="12" cy="4" r="2"/><rect x="3" y="17" width="4" height="4" rx="1"/><rect x="10" y="17" width="4" height="4" rx="1"/><rect x="17" y="17" width="4" height="4" rx="1"/>',
  dfs: '<path d="M5 6v12h7V6h7v12M16 15l3 3 3-3"/><circle cx="5" cy="4" r="2"/>',
  path: '<path d="M7 5h10a4 4 0 0 1 0 8H7a3 3 0 0 0 0 6h10M15 16l3 3-3 3"/><circle cx="5" cy="5" r="2"/>',
  compare: '<path d="M12 4v16M4 7h16M7 7l-4 8h8L7 7ZM17 7l-4 8h8l-4-8ZM8 21h8"/>',
  book: '<path d="M12 6v15M12 6C9 3 5 3 3 4v15c3-1 6-1 9 2 3-3 6-3 9-2V4c-2-1-6-1-9 2Z"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18"/>',
  play: '<path d="m8 5 11 7-11 7Z"/>',
  reset: '<path d="M4 10a8 8 0 1 1 1 8M4 4v6h6"/>',
  experiment: '<path d="M9 3h6m-5 0v7L4 19q-1 2 2 2h12q3 0 2-2l-6-9V3M7 15h10"/>',
};
export function icon(name, className='ui-icon') {
  return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[name] || shapes.basics}</svg>`;
}
// Иллюстрация темы, а не снимок текущего состояния алгоритма.
export function courseIllustration() {
  return `<svg class="course-illustration" viewBox="0 0 260 190" aria-hidden="true"><g fill="none" stroke="#b2c6e7" stroke-width="2.5"><path d="M41 96 107 40 206 68 179 147 41 96M107 40l72 107M41 96l165-28"/></g><path d="m41 96 66-56 99 28" stroke="#3464cf" fill="none" stroke-width="4"/><g stroke-width="2"><circle cx="41" cy="96" r="22" fill="#285bc7" stroke="#285bc7"/><circle cx="107" cy="40" r="22" fill="#e6edff" stroke="#7092d7"/><circle cx="206" cy="68" r="22" fill="#e2f2ec" stroke="#62a28b"/><circle cx="179" cy="147" r="22" fill="#fff" stroke="#b2c6e7"/></g><g text-anchor="middle" dominant-baseline="central" font-size="19" font-weight="650" fill="#285178"><text x="41" y="96" fill="#fff">1</text><text x="107" y="40">2</text><text x="206" y="68">3</text><text x="179" y="147">4</text></g></svg>`;
}
