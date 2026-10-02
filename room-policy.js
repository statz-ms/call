/* Um lugar por convidado, inclusive durante a negociação da conexão. */
(function (root) {
  root.StatzRoomPolicy = {
    normalizeMode: mode => mode === 'duo' ? 'duo' : 'group',
    iceConfig(mode, groupConfig) {
      if (mode !== 'duo') return groupConfig;
      return { iceTransportPolicy: 'all', iceServers: groupConfig.iceServers.filter(server => {
        const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
        return urls.every(url => /^stuns?:/i.test(url));
      }) };
    },
    createAdmission(mode) {
      const guests = new Set();
      return {
        reserve(id) {
          if (guests.has(id)) return true;
          if (mode === 'duo' && guests.size >= 1) return false;
          guests.add(id); return true;
        },
        has: id => guests.has(id),
        release: id => guests.delete(id),
        clear: () => guests.clear()
      };
    }
  };
})(globalThis);
