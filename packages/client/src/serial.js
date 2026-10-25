// Serializa uma operação lógica inteira, não só cada leitura/escrita do banco.
export function serial() {
  let tail = Promise.resolve();
  return (fn) => {
    const result = tail.then(fn, fn);
    tail = result.catch(() => {});
    return result;
  };
}
