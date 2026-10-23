// 015-05: JSX through the TSX grammar.
export function List({ items, empty = "none" }: { items?: string[]; empty?: string }) {
  if (!items?.length) return <p>{empty}</p>;
  return (
    <ul>
      {items.map((item, i) => (
        <li key={i} className={i % 2 ? "odd" : "even"}>
          {item || "?"}
        </li>
      ))}
    </ul>
  );
}
export const Badge = ({ on }: { on: boolean }) => on && <b onClick={() => on ?? false}>on</b>;
