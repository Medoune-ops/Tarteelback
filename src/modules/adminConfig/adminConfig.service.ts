import { adminConfigRepository } from './adminConfig.repository.js';
import type { UpdateConfigBody } from './adminConfig.schemas.js';

function serialize(row: { paymentsEnabled: boolean; updatedAt: Date }) {
  return { paymentsEnabled: row.paymentsEnabled, updatedAt: row.updatedAt };
}

export const adminConfigService = {
  /** GET /backoffice/config and GET /config (public) */
  async get() {
    return serialize(await adminConfigRepository.get());
  },

  /** PATCH /backoffice/config */
  async update(body: UpdateConfigBody) {
    return serialize(await adminConfigRepository.update(body));
  },
};
