plugins {
    id("buildlogic.java-common-conventions")
    id("io.quarkus")
    id("jacoco-report-aggregation")
}

val quarkusPlatformGroupId: String by project
val quarkusPlatformArtifactId: String by project
val quarkusPlatformVersion: String by project

dependencies {
    implementation(project(":base"))
    implementation(project(":core"))
    implementation(project(":deep"))
    implementation(project(":nlp"))
    implementation(project(":plot"))
    implementation(enforcedPlatform("${quarkusPlatformGroupId}:${quarkusPlatformArtifactId}:${quarkusPlatformVersion}"))
    implementation("io.quarkus:quarkus-rest")
    implementation("io.quarkus:quarkus-rest-jackson")
    implementation("io.quarkus:quarkus-websockets-next")
    implementation("io.quarkus:quarkus-arc")

    // Agentic AutoML: the ioa-agent framework (Clair's automl skill) plus the LLM
    // client SDKs it needs at runtime (ADR-0005). The jars are vendored in serve/lib
    // because they are not published to a Maven repository.
    implementation(fileTree("lib/") { include("*.jar") })
    implementation("com.openai:openai-java:4.33.0")
    implementation("com.anthropic:anthropic-java:2.27.0")
    implementation("com.google.genai:google-genai:1.53.0")
    implementation("io.modelcontextprotocol.sdk:mcp:1.1.2")
    // ioa-agent tool dependencies (web fetch / search / markdown), mirroring studio.
    implementation("io.github.furstenheim:copy_down:1.1")
    implementation("org.jsoup:jsoup:1.22.2")
    implementation("com.github.serpapi:serpapi-java:1.1.0")
    implementation("com.google.code.gson:gson:2.14.0")
    implementation("org.jboss.slf4j:slf4j-jboss-logmanager")
    implementation("io.quarkus:quarkus-hibernate-orm-panache")
    implementation("io.quarkus:quarkus-jdbc-postgresql")
    implementation("io.quarkus:quarkus-jdbc-h2")
    implementation("io.quarkiverse.jdbc:quarkus-jdbc-sqlite:3.0.11")
    implementation("io.quarkiverse.quinoa:quarkus-quinoa:2.8.2")
    testImplementation("io.quarkus:quarkus-junit5")
    testImplementation("io.quarkus:quarkus-test-h2")
    testImplementation("io.rest-assured:rest-assured:6.0.0")

    // JaCoCo aggregated report
    jacocoAggregation(project(":base"))
    jacocoAggregation(project(":core"))
    jacocoAggregation(project(":deep"))
}

// The ioa-agent framework uses Jackson 3 (tools.jackson), whose databind 3.2.0 calls
// JacksonAnnotationIntrospector.findApplyView — the @JsonApplyView annotation was added
// in jackson-annotations 2.22. The Quarkus BOM otherwise pins annotations to 2.21, which
// triggers NoClassDefFoundError at agent runtime. Force 2.22 so Jackson 3 resolves it.
configurations.all {
    resolutionStrategy {
        force("com.fasterxml.jackson.core:jackson-annotations:2.22")
    }
}

tasks.withType<Test> {
    systemProperty("java.util.logging.manager", "org.jboss.logmanager.LogManager")
}

tasks.quarkusDev {
    jvmArgs = listOf(
        "--add-opens", "java.base/java.lang=ALL-UNNAMED",
        "--add-opens", "java.base/java.nio=ALL-UNNAMED",
        "--enable-native-access", "ALL-UNNAMED")
}

tasks.withType<JavaCompile> {
    options.encoding = "UTF-8"
    options.compilerArgs.add("-parameters")
}

tasks.withType<Javadoc> {
    enabled = false
}

