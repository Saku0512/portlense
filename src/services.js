const services = {
  TCP: { 20: 'FTP-DATA', 21: 'FTP', 22: 'SSH', 23: 'TELNET', 25: 'SMTP', 53: 'DNS', 80: 'HTTP', 110: 'POP3', 143: 'IMAP', 443: 'HTTPS', 465: 'SMTPS', 587: 'SMTP', 993: 'IMAPS', 995: 'POP3S', 3306: 'MYSQL', 5432: 'POSTGRESQL', 6379: 'REDIS', 8080: 'HTTP-ALT' },
  UDP: { 53: 'DNS', 67: 'DHCP', 68: 'DHCP', 123: 'NTP', 161: 'SNMP', 443: 'HTTPS', 5353: 'MDNS' },
};

// Common conventions only; a process may use a port for a different service.
export function getServiceName(port, protocol = 'TCP') {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RangeError('Port must be an integer from 1 to 65535.');
  if (typeof protocol !== 'string' || !['TCP', 'UDP'].includes(protocol.toUpperCase())) throw new TypeError('Protocol must be TCP or UDP.');
  return services[protocol.toUpperCase()][port] || '';
}
