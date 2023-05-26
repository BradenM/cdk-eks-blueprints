import { PolicyDocument } from 'aws-cdk-lib/aws-iam';
import { Construct } from "constructs";
import * as iam from "aws-cdk-lib/aws-iam";
import { setPath } from "../../utils";
import { HelmAddOn, HelmAddOnUserProps } from "../helm-addon";
import { ClusterInfo, Values } from "../../spi/types";
import { createNamespace } from "../../utils/namespace-utils";
import { getCloudWatchLogsPolicyDocument } from "./iam-policy";

/**
 * Configuration options for the FluentBit add-on.
 */
export interface CloudWatchLogsAddonProps extends HelmAddOnUserProps {
    /**
     * Iam policies for the add-on.
     */
    policyDocumentProvider?: (partition: string) => PolicyDocument;

    /**
     * Create Namespace with the provided one (will not if namespace is kube-system)
     */
    createNamespace?: boolean

    /**
     * Name of the service account for fluent bit.
     */
    serviceAccountName?: string;

    /**
     * CloudWatch Log retention days
     */
    logRetentionDays?: number;
}
/**
 * Default props for the add-on.
 */
const defaultProps: CloudWatchLogsAddonProps = {
    name: 'aws-for-fluent-bit',
    chart: 'aws-for-fluent-bit',
    release: "blueprints-addon-aws-fluent-bit-for-cw",
    version: '0.1.24',
    repository: 'https://aws.github.io/eks-charts',
    namespace: 'aws-for-fluent-bit',
    createNamespace: true,
    serviceAccountName: 'aws-fluent-bit-for-cw-sa',
    logRetentionDays: 90,
    values: {}
};

/**
 * CloudWatchLogsAddon deploys FluentBit into an EKS cluster using the `aws-for-fluent-bit` Helm chart.
 * https://github.com/aws/eks-charts/tree/master/stable/aws-for-fluent-bit
 * 
 */
export class CloudWatchLogsAddon extends HelmAddOn {

    readonly options: CloudWatchLogsAddonProps;

    constructor(props?: CloudWatchLogsAddonProps) {
        super({ ...defaultProps as any, ...props });
        this.options = this.props;
    }

    deploy(clusterInfo: ClusterInfo): Promise<Construct> {
        let values: Values = populateValues(clusterInfo, this.options);
        const cluster = clusterInfo.cluster;
        const namespace = this.options.namespace!;

        // Create the FluentBut service account.
        const serviceAccountName = this.options.serviceAccountName!;
        const sa = cluster.addServiceAccount(serviceAccountName, {
            name: serviceAccountName,
            namespace: namespace
        });

        // Create namespace
        if (this.options.createNamespace) {
            const ns = createNamespace(namespace, cluster, true);
            sa.node.addDependency(ns);
        }

        // Apply additional IAM policies to the service account.
        getCloudWatchLogsPolicyDocument().forEach((statement) => {
            sa.addToPrincipalPolicy(iam.PolicyStatement.fromJson(statement));
        });

        const helmChart = this.addHelmChart(clusterInfo, values);
        helmChart.node.addDependency(sa);
        return Promise.resolve(helmChart);
    }
}

/**
 * populateValues populates the appropriate values used to customize the Helm chart
 * @param helmOptions User provided values to customize the chart
 */
function populateValues(clusterInfo: ClusterInfo, helmOptions: CloudWatchLogsAddonProps): Values {
    const values = helmOptions.values ?? {};
    setPath(values, "serviceAccount.name", helmOptions.serviceAccountName);
    setPath(values, "serviceAccount.create", false);
    setPath(values, "cloudWatch.enabled", false);
    setPath(values, "cloudWatchLogs.enabled", true);
    setPath(values, "cloudWatchLogs.region", clusterInfo.cluster.stack.region);
    setPath(values, "cloudWatchLogs.logGroupName", `/aws/eks/${clusterInfo.cluster.clusterName}/workloads`);
    setPath(values, "cloudWatchLogs.logGroupTemplate", `/aws/eks/${clusterInfo.cluster.clusterName}/$kubernetes['namespace_name']`);
    setPath(values, "cloudWatchLogs.logStreamTemplate", "$kubernetes['container_name'].$kubernetes['pod_name']");
    setPath(values, "cloudWatchLogs.log_key", "log");
    setPath(values, "cloudWatchLogs.log_retention_days", helmOptions.logRetentionDays);
    return values;
}