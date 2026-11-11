import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import type { EstadoNumero } from '../lib/estados';
import { NumberGrid } from './NumberGrid';

function Envoltura({ max = 2 }: { max?: number }) {
  const numeros = new Map<number, EstadoNumero>([[1, 'disponible'], [2, 'reservado'], [3, 'vendido'], [4, 'disponible'], [5, 'disponible'], [6, 'bloqueado']]);
  const [sel, setSel] = useState<Set<number>>(new Set());
  return <NumberGrid numeros={numeros} seleccion={sel} maxSeleccion={max}
    onAlternar={(n) => setSel((s) => { const x = new Set(s); if (x.has(n)) x.delete(n); else x.add(n); return x; })} />;
}

describe('NumberGrid', () => {
  it('sólo permite seleccionar números disponibles', () => {
    render(<Envoltura />);
    expect(screen.getByLabelText('Número 2: Reservado')).toBeDisabled();
    expect(screen.getByLabelText('Número 3: Vendido')).toBeDisabled();
    expect(screen.getByLabelText('Número 6: No disponible')).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Número 1: Disponible'));
    expect(screen.getByLabelText('Número 1: Seleccionado')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByLabelText('Número 1: Seleccionado'));
    expect(screen.getByLabelText('Número 1: Disponible')).toBeInTheDocument();
  });
  it('respeta el máximo por reserva', () => {
    render(<Envoltura max={2} />);
    fireEvent.click(screen.getByLabelText('Número 1: Disponible'));
    fireEvent.click(screen.getByLabelText('Número 4: Disponible'));
    fireEvent.click(screen.getByLabelText('Número 5: Disponible'));
    expect(screen.getByLabelText('Número 5: Disponible')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('máximo de 2');
  });
  it('filtra sólo disponibles y busca', () => {
    render(<Envoltura />);
    fireEvent.click(screen.getByRole('button', { name: /Sólo disponibles \(3\)/ }));
    expect(screen.queryByLabelText('Número 3: Vendido')).toBeNull();
    fireEvent.change(screen.getByLabelText('Buscar número'), { target: { value: '4' } });
    expect(screen.getAllByRole('button', { name: /^Número/ })).toHaveLength(1);
  });
});
