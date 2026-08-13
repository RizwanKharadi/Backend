/**
 * Loaders that feed NamePicker on the insight screens.
 *
 * Both return the name as stored, because that is what the insight endpoints
 * match on. Anything shown alongside is context to help pick the right row, not
 * part of the value.
 */

import { partyService } from '../services/partyService';
import { inventoryService } from '../services/inventoryService';
import type { PickerOption } from './NamePicker';

const PAGE_SIZE = 50;

export async function loadPartyOptions(search: string): Promise<PickerOption[]> {
  const result = await partyService.getParties({
    limit: PAGE_SIZE,
    search: search || undefined,
  });

  return (result?.data || [])
    .map((party) => ({
      // displayName is what the app shows, but name is what Tally stores and
      // what the outstanding report is keyed by.
      name: party.name || party.displayName || '',
      subtitle: party.displayName && party.displayName !== party.name ? party.displayName : undefined,
    }))
    .filter((option) => option.name);
}

export async function loadItemOptions(search: string): Promise<PickerOption[]> {
  const result = await inventoryService.getItems({
    limit: PAGE_SIZE,
    search: search || undefined,
  });

  // inventoryService already resolves each item to its display name; the
  // forecast endpoint matches on either that or the stored name.
  const list = Array.isArray(result?.data) ? result.data : [];

  return list
    .map((item) => ({
      name: item?.name || '',
      subtitle:
        typeof item?.currentStock === 'number' ? `In stock: ${item.currentStock}` : undefined,
    }))
    .filter((option) => option.name);
}
