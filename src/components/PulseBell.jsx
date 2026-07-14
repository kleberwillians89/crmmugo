import {Bell} from 'lucide-react'
import {pulseSummary} from '../services/pulse/pulseEngine'
export function PulseBell({alerts,onOpen}){const {counts}=pulseSummary(alerts);return <button className="pulse-bell" type="button" onClick={onOpen} aria-label={`Alertas: ${counts.critical} críticos, ${counts.medium} médios, ${counts.informational} informativos`}><Bell size={19}/>{counts.critical>0&&<b>{counts.critical}</b>}<span><i className="critical">{counts.critical}</i><i className="medium">{counts.medium}</i><i className="informational">{counts.informational}</i></span></button>}
