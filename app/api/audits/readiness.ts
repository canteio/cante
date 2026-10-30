import type {AuditResult,Finding} from './model';
export type BlockerKind='shipment_data'|'historical_sources'|'rule_support'|'evidence';
export const blockerLabels:Record<BlockerKind,string>={shipment_data:'Missing shipment information',historical_sources:'Missing historical sources',rule_support:'Tariff rule needs support',evidence:'Evidence needs review'};
/** Based on actual engine findings, never a model-written readiness assurance. */
export function findingBlocker(finding:Finding,result:AuditResult):BlockerKind|null{
 if(finding.certainty==='calculated')return null;
 if(['adcvd_shipment','invalid_input','missing_paid_duty','unmatched_product','content_value','missing_quantity','quantity_conflict','chapter99_boundary','statistical_components','statistical_code','classification_value'].includes(finding.type))return 'shipment_data';
 if(finding.type==='adcvd_sources')return 'historical_sources';
 if(finding.type==='adcvd_instructions')return 'rule_support';
 if(finding.type==='duty_expression')return 'rule_support';
 if(['historical_coverage','historical_reference_found'].includes(finding.type))return result.reference?.gaps.some(g=>g.startsWith('PDF table lookup:'))?'rule_support':!result.reference?.release||!result.reference?.rate?'historical_sources':'rule_support';
 if(['chapter99_review','base_coverage','stacking_review','chapter99_exclusion_scope'].includes(finding.type))return 'rule_support';
 return 'evidence';
}
export function auditBlockers(result:AuditResult){
 const groups:Record<BlockerKind,Finding[]>={shipment_data:[],historical_sources:[],rule_support:[],evidence:[]};
 for(const finding of result.findings){const kind=findingBlocker(finding,result);if(kind)groups[kind].push(finding);}
 return groups;
}
